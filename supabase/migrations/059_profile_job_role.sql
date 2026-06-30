-- Informational job role on office user profiles (admin-assigned only).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_role text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.profiles.job_role IS
  'Informational office role slug (pm, super, foreman, etc.). Admin-only via RPC; not used for permissions.';

CREATE OR REPLACE FUNCTION public.list_approved_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  job_role text,
  approved_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, u.email::text, coalesce(p.job_role, ''), p.approved_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.approved_at IS NOT NULL
    AND public.is_app_admin()
  ORDER BY lower(u.email);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_job_role(
  target_user_id uuid,
  p_job_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_role text := lower(trim(coalesce(p_job_role, '')));
  allowed text[] := ARRAY['', 'pm', 'super', 'foreman', 'estimator', 'pe', 'admin'];
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF NOT (clean_role = ANY (allowed)) THEN
    RAISE EXCEPTION 'Invalid job role';
  END IF;

  UPDATE public.profiles
  SET job_role = clean_role
  WHERE id = target_user_id
    AND approved_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved user not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_approved_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_job_role(uuid, text) TO authenticated;
